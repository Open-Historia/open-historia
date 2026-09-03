/*! Open Historia — national stats pane © 2026 Nicholas Krol, MIT (see src/Editor/LICENSE). */
import React, { memo, startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { JSON_URLS, getNationFlags, readJson, reportPerfOperation } from "../../runtime/assets.js";
import { isPolityLandless, readGameData, readWorldState, readWorldStateView, writeWorldState } from "../../runtime/gameState.js";
import { useLibraryState } from "../../runtime/library.js";
import { useCountryDisplayName } from "../../runtime/polityNames.js";
import { resolvePolityIdentity } from "../../runtime/polityIdentity.js";
import { flagImageUrlFromGid } from "../../runtime/countryFlags.js";
import COUNTRY_NAMES from "../../runtime/generated/countryNames.js";
import { setRegionClickObserver } from "../Selection/Regions.jsx";
import { generateCountryStatSheet } from "../AI/gameplay.js";
import { validateGameplayPayload } from "../AI/gameplaySchemas.js";
import {
    appendCountryStatHistorySample,
    buildCountryStatHistorySample,
    COUNTRY_STATS_POPULATION_CALIBRATION_VERSION,
    COUNTRY_STATS_TRACKING_INTERVALS,
    COUNTRY_STATS_TRACKING_MAX_POLITIES,
    countryStatsTrackingIntervalLabel,
    finalizeCountryStatSheet,
    isCompleteCountryStatSheet,
    mergeCountryStatPatch,
    mergeCountryStatsHistory,
    normalizeCountryStatHistorySample,
    normalizeCountryStatsHistory,
    normalizeCountryStatsTracking,
} from "../../runtime/countryStats.js";

// Sheets are regenerated when the game date moves; within a date they persist
// across reloads so flipping between countries stays instant.
// 8B.2.18.1: canonical world.countryStats is the persistent source of truth. The
// browser cache is only a convenience fallback, so never synchronously serialize
// giant province ledgers into localStorage (which stalls the UI on detailed maps).
const STORAGE_KEY = "oh-stat-sheets-v2";
const TRACKING_STORAGE_KEY = "oh-stat-tracking-v1";
const MAX_STORED_SHEETS = 20;
const MAX_LOCAL_CACHE_COMPONENTS = 64;
const memoryCache = new Map();

const readTrackingSettingsFallback = (gameKey, playerCountry = "") => {
    if (!gameKey) return normalizeCountryStatsTracking({}, { playerCountry });
    try {
        const all = JSON.parse(localStorage.getItem(TRACKING_STORAGE_KEY) || "{}");
        return normalizeCountryStatsTracking(all?.[gameKey], { playerCountry });
    } catch {
        return normalizeCountryStatsTracking({}, { playerCountry });
    }
};

const storeTrackingSettingsFallback = (gameKey, value, playerCountry = "") => {
    if (!gameKey) return;
    try {
        const all = JSON.parse(localStorage.getItem(TRACKING_STORAGE_KEY) || "{}");
        all[gameKey] = normalizeCountryStatsTracking(value, { playerCountry });
        localStorage.setItem(TRACKING_STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Canonical settings live in world state. This fallback is only migration convenience.
    }
};

const isValidStatSheet = (value) => {
    const sheet = finalizeCountryStatSheet(value);
    return isCompleteCountryStatSheet(sheet) && validateGameplayPayload("countryStatSheet", sheet).valid;
};

// 8B.2.16 compatibility repair: one older Stats path could plan >64 live-map
// components correctly and then silently persist only the first 64. A cached sheet
// with exactly 64 components therefore needs one native territorial audit before the
// UI trusts it. A sheet that has already passed 8B.2.18.1 regional causal calibration no longer
// needs this legacy ambiguity check.
const populationCalibrationVersion = (value) =>
    Math.max(0, Math.trunc(Number(value?.continuity?.populationCalibrationVersion) || 0));

const needsLegacyComponentCapAudit = (value) =>
    Array.isArray(value?.territorialComponents) &&
    value.territorialComponents.length === 64 &&
    populationCalibrationVersion(value) < COUNTRY_STATS_POPULATION_CALIBRATION_VERSION;

// 8B.2.18 start-state migration. Old full-component sheets can be structurally valid
// yet have a bad national scale because hundreds of province estimates or one opaque
// whole-polity anchor were used. Rebuild those once through bounded regional calibration
// automatically ONLY at Round One/start date. Mature alternate-history campaigns are
// never silently re-anchored; they keep their persisted canon unless the user asks for
// a hard audit.
const needsStartPopulationCalibrationAudit = (value, player) => Boolean(
    value &&
    player?.startDate &&
    player?.date === player.startDate &&
    Number(player?.round) <= 1 &&
    populationCalibrationVersion(value) < COUNTRY_STATS_POPULATION_CALIBRATION_VERSION
);

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
        const componentCount = Array.isArray(entry?.sheet?.territorialComponents)
            ? entry.sheet.territorialComponents.length
            : 0;
        if (componentCount > MAX_LOCAL_CACHE_COMPONENTS) return;
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

// ---------------------------------------------------------------------------
// 8B.3 — Advanced Statistics
// ---------------------------------------------------------------------------
const ADVANCED_METRIC_GROUPS = [
    {
        key: "headline",
        label: "Headline economy",
        icon: "◈",
        metrics: [
            { key: "gdp", label: "GDP", unit: "gdp", color: "#34d399", format: formatEuroTotal },
            { key: "gdpPerCapita", label: "GDP per capita", unit: "gdpPerCapita", color: "#e5e7eb", format: formatEuroPerCapita },
            { key: "population", label: "Population", unit: "population", color: "#a78bfa", format: formatPopulation },
        ],
    },
    {
        key: "economy",
        label: "Economic conditions",
        icon: "↗",
        metrics: [
            { key: "gdpGrowth", label: "GDP growth", unit: "economicPercent", color: "#34d399", format: (value) => formatPercent(value, { signed: true }) },
            { key: "inflation", label: "Inflation", unit: "economicPercent", color: "#f59e0b", format: formatPercent },
            { key: "unemployment", label: "Unemployment", unit: "economicPercent", color: "#60a5fa", format: formatPercent },
            { key: "publicDebt", label: "Public debt", unit: "economicPercent", color: "#c084fc", format: formatPercent },
            { key: "budgetBalance", label: "Budget balance", unit: "economicPercent", color: "#f87171", format: (value) => formatPercent(value, { signed: true }) },
        ],
    },
    {
        key: "strategic",
        label: "Strategic indices",
        icon: "⚑",
        metrics: [
            { key: "stability", label: "National stability", unit: "index", color: "#22c55e", format: (value) => `${Math.round(Number(value) || 0)}` },
            ...INDEX_ROWS.map((row) => ({
                key: row.key,
                label: row.label,
                unit: "index",
                color: row.color,
                format: (value) => `${Math.round(Number(value) || 0)}%`,
            })),
        ],
    },
    {
        key: "sectors",
        label: "GDP sectors",
        icon: "▦",
        metrics: [
            { key: "agriculture", label: "Agriculture", unit: "sector", color: "#22c55e", format: formatPercent },
            { key: "industry", label: "Industry", unit: "sector", color: "#3b82f6", format: formatPercent },
            { key: "services", label: "Services", unit: "sector", color: "#8b5cf6", format: formatPercent },
        ],
    },
];

const ADVANCED_METRICS = Object.fromEntries(
    ADVANCED_METRIC_GROUPS.flatMap((group) => group.metrics.map((metric) => [metric.key, metric])),
);

const ADVANCED_UNIT_LABELS = {
    gdp: "GDP · 2026-EUR equivalent",
    gdpPerCapita: "GDP per capita · 2026-EUR equivalent",
    population: "Population",
    economicPercent: "Percent",
    index: "Index · 0–100",
    sector: "Share of GDP · %",
};

const formatHistoryDate = (value, { compact = false } = {}) => {
    const text = String(value || "");
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return text || "Unknown date";
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return new Intl.DateTimeFormat(undefined, compact
        ? { month: "short", year: "numeric", timeZone: "UTC" }
        : { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
};

const historyDateMs = (value) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : NaN;
};

const advancedRangeStyle = (active) => ({
    backgroundColor: active ? "rgba(59,130,246,0.2)" : "rgba(255,255,255,0.035)",
    border: `1px solid ${active ? "rgba(96,165,250,0.55)" : "rgba(255,255,255,0.08)"}`,
    borderRadius: "7px",
    color: active ? "#dbeafe" : "rgba(255,255,255,0.5)",
    cursor: "pointer",
    fontSize: "0.68rem",
    fontWeight: 800,
    padding: "0.42rem 0.62rem",
});

const AdvancedLineChart = ({ samples, metricKeys }) => {
    const [hoverIndex, setHoverIndex] = useState(null);
    const metrics = metricKeys.map((key) => ADVANCED_METRICS[key]).filter(Boolean);
    const validSamples = samples.filter((sample) => metrics.some((metric) => Number.isFinite(Number(sample?.[metric.key]))));

    if (!validSamples.length || !metrics.length) {
        return (
            <div style={{ alignItems: "center", color: "rgba(255,255,255,0.38)", display: "flex", flex: 1, fontSize: "0.82rem", justifyContent: "center", minHeight: "330px", textAlign: "center" }}>
                No historical samples are available for this selection yet.
            </div>
        );
    }

    const width = 900;
    const height = 470;
    const pad = { left: 78, right: 34, top: 34, bottom: 58 };
    const plotWidth = width - pad.left - pad.right;
    const plotHeight = height - pad.top - pad.bottom;
    const times = validSamples.map((sample) => historyDateMs(sample.date)).filter(Number.isFinite);
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    const timeSpan = Math.max(1, maxTime - minTime);
    const values = validSamples.flatMap((sample) => metrics.map((metric) => Number(sample?.[metric.key])).filter(Number.isFinite));
    let minValue = Math.min(...values);
    let maxValue = Math.max(...values);
    const unit = metrics[0]?.unit;
    if (unit === "index" || unit === "sector") {
        minValue = 0;
        maxValue = 100;
    } else {
        const span = Math.max(0.0001, maxValue - minValue);
        const padding = span * 0.12;
        minValue -= padding;
        maxValue += padding;
        if (unit === "population" || unit === "gdp" || unit === "gdpPerCapita") minValue = Math.max(0, minValue);
        if (minValue === maxValue) {
            minValue -= Math.abs(minValue || 1) * 0.08;
            maxValue += Math.abs(maxValue || 1) * 0.08;
        }
    }
    const valueSpan = Math.max(0.0001, maxValue - minValue);
    const xFor = (sample) => pad.left + ((historyDateMs(sample.date) - minTime) / timeSpan) * plotWidth;
    const yFor = (value) => pad.top + plotHeight - ((Number(value) - minValue) / valueSpan) * plotHeight;
    const yTicks = Array.from({ length: 5 }, (_, index) => minValue + ((maxValue - minValue) * index) / 4).reverse();
    const xTickIndexes = [...new Set(Array.from({ length: Math.min(5, validSamples.length) }, (_, index) =>
        Math.round((index * (validSamples.length - 1)) / Math.max(1, Math.min(5, validSamples.length) - 1))))];
    const axisFormat = metrics[0]?.format || ((value) => String(value));
    const hovered = hoverIndex == null ? null : validSamples[hoverIndex];
    const hoverX = hovered ? xFor(hovered) : null;

    const pathFor = (metric) => {
        let path = "";
        let started = false;
        validSamples.forEach((sample) => {
            const value = Number(sample?.[metric.key]);
            if (!Number.isFinite(value)) {
                started = false;
                return;
            }
            const command = started ? "L" : "M";
            path += `${command}${xFor(sample).toFixed(2)},${yFor(value).toFixed(2)} `;
            started = true;
        });
        return path.trim();
    };

    return (
        <div style={{ minHeight: 0, position: "relative", width: "100%" }}>
            <svg aria-label="Historical statistics chart" role="img" viewBox={`0 0 ${width} ${height}`} style={{ display: "block", height: "auto", maxHeight: "58vh", minHeight: "340px", width: "100%" }}>
                <defs>
                    <linearGradient id="ohStatsGridFade" x1="0" x2="1">
                        <stop offset="0%" stopColor="rgba(255,255,255,0.02)" />
                        <stop offset="50%" stopColor="rgba(255,255,255,0.06)" />
                        <stop offset="100%" stopColor="rgba(255,255,255,0.02)" />
                    </linearGradient>
                </defs>
                <rect x={pad.left} y={pad.top} width={plotWidth} height={plotHeight} rx="10" fill="rgba(2,6,23,0.18)" stroke="rgba(255,255,255,0.06)" />
                {yTicks.map((tick, index) => {
                    const y = pad.top + (plotHeight * index) / Math.max(1, yTicks.length - 1);
                    return (
                        <g key={`y-${index}`}>
                            <line x1={pad.left} x2={width - pad.right} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" strokeDasharray={index === yTicks.length - 1 ? "0" : "3 6"} />
                            <text x={pad.left - 12} y={y + 4} textAnchor="end" fill="rgba(255,255,255,0.42)" fontSize="12" fontWeight="600">{axisFormat(tick)}</text>
                        </g>
                    );
                })}
                {xTickIndexes.map((sampleIndex) => {
                    const sample = validSamples[sampleIndex];
                    const x = xFor(sample);
                    return (
                        <g key={`x-${sample.date}`}>
                            <line x1={x} x2={x} y1={pad.top} y2={pad.top + plotHeight} stroke="rgba(255,255,255,0.05)" />
                            <text x={x} y={height - 24} textAnchor="middle" fill="rgba(255,255,255,0.42)" fontSize="12" fontWeight="600">{formatHistoryDate(sample.date, { compact: true })}</text>
                        </g>
                    );
                })}
                {metrics.map((metric) => (
                    <path key={metric.key} d={pathFor(metric)} fill="none" stroke={metric.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ filter: `drop-shadow(0 0 5px ${metric.color}44)` }} />
                ))}
                {validSamples.length <= 24 && metrics.map((metric) => validSamples.map((sample) => {
                    const value = Number(sample?.[metric.key]);
                    if (!Number.isFinite(value)) return null;
                    return <circle key={`${metric.key}-${sample.date}`} cx={xFor(sample)} cy={yFor(value)} r="3.7" fill={metric.color} stroke="#0f172a" strokeWidth="2" />;
                }))}
                {hovered && (
                    <>
                        <line x1={hoverX} x2={hoverX} y1={pad.top} y2={pad.top + plotHeight} stroke="rgba(255,255,255,0.34)" strokeWidth="1" />
                        {metrics.map((metric) => {
                            const value = Number(hovered?.[metric.key]);
                            if (!Number.isFinite(value)) return null;
                            return <circle key={`hover-${metric.key}`} cx={hoverX} cy={yFor(value)} r="6" fill={metric.color} stroke="#0f172a" strokeWidth="3" />;
                        })}
                    </>
                )}
                {validSamples.map((sample, index) => {
                    const x = xFor(sample);
                    const prev = index > 0 ? xFor(validSamples[index - 1]) : pad.left;
                    const next = index < validSamples.length - 1 ? xFor(validSamples[index + 1]) : width - pad.right;
                    const left = index === 0 ? pad.left : (prev + x) / 2;
                    const right = index === validSamples.length - 1 ? width - pad.right : (x + next) / 2;
                    return <rect key={`hit-${sample.date}`} x={left} y={pad.top} width={Math.max(2, right - left)} height={plotHeight} fill="transparent" onMouseEnter={() => setHoverIndex(index)} onMouseMove={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex(null)} />;
                })}
                <text x={pad.left} y="18" fill="rgba(255,255,255,0.38)" fontSize="11" fontWeight="700" letterSpacing="1">{ADVANCED_UNIT_LABELS[unit] || "Value"}</text>
            </svg>
            {hovered && (
                <div style={{ backgroundColor: "rgba(9,14,27,0.96)", border: "1px solid rgba(148,163,184,0.22)", borderRadius: "10px", boxShadow: "0 12px 35px rgba(0,0,0,0.35)", left: `min(calc(${((hoverX / width) * 100).toFixed(2)}% + 10px), calc(100% - 190px))`, padding: "0.55rem 0.65rem", pointerEvents: "none", position: "absolute", top: "1.1rem", width: "180px", zIndex: 2 }}>
                    <div data-no-translate style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.64rem", fontWeight: 800, letterSpacing: "0.04em", marginBottom: "0.45rem", textTransform: "uppercase" }}>{formatHistoryDate(hovered.date)}</div>
                    {metrics.map((metric) => {
                        const value = Number(hovered?.[metric.key]);
                        if (!Number.isFinite(value)) return null;
                        return (
                            <div key={metric.key} style={{ alignItems: "center", display: "flex", gap: "0.45rem", justifyContent: "space-between", marginTop: "0.28rem" }}>
                                <span style={{ alignItems: "center", color: "rgba(255,255,255,0.62)", display: "flex", fontSize: "0.66rem", gap: "0.35rem", minWidth: 0 }}><span style={{ backgroundColor: metric.color, borderRadius: "999px", height: "7px", width: "7px" }} />{metric.label}</span>
                                <span data-no-translate style={{ color: "#fff", fontSize: "0.7rem", fontWeight: 850 }}>{metric.format(value)}</span>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

const AdvancedStatsModal = ({
    open,
    onClose,
    countryName,
    flagUrl,
    flagFallback,
    samples,
    status,
    error,
    recoveredCount,
    persistentCount,
}) => {
    const [metricKeys, setMetricKeys] = useState(["gdp"]);
    const [range, setRange] = useState("all");

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);

        // Advanced Statistics is portaled to document.body so it escapes the
        // narrow Stats drawer's transformed/clipped containing block. Lock the
        // page behind it while the full-workspace viewer is open.
        const priorOverflow = document?.body?.style?.overflow ?? "";
        if (document?.body) document.body.style.overflow = "hidden";

        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (document?.body) document.body.style.overflow = priorOverflow;
        };
    }, [open, onClose]);

    if (!open || typeof document === "undefined") return null;

    const selectedMetrics = metricKeys.map((key) => ADVANCED_METRICS[key]).filter(Boolean);
    const selectedUnit = selectedMetrics[0]?.unit || "gdp";
    const latestMs = samples.reduce((max, sample) => Math.max(max, historyDateMs(sample.date) || 0), 0);
    const years = range === "1y" ? 1 : range === "5y" ? 5 : range === "10y" ? 10 : null;
    const cutoff = years && latestMs ? latestMs - years * 365.2425 * 24 * 60 * 60 * 1000 : null;
    const visibleSamples = cutoff ? samples.filter((sample) => historyDateMs(sample.date) >= cutoff) : samples;
    const first = visibleSamples[0];
    const last = visibleSamples[visibleSamples.length - 1];

    const toggleMetric = (metric) => {
        setMetricKeys((current) => {
            if (current.includes(metric.key)) {
                if (current.length === 1) return current;
                return current.filter((key) => key !== metric.key);
            }
            const currentUnit = ADVANCED_METRICS[current[0]]?.unit;
            if (currentUnit !== metric.unit) return [metric.key];
            if (current.length >= 4) return [...current.slice(1), metric.key];
            return [...current, metric.key];
        });
    };

    const sampleSpan = visibleSamples.length > 1
        ? `${formatHistoryDate(visibleSamples[0].date, { compact: true })} – ${formatHistoryDate(visibleSamples[visibleSamples.length - 1].date, { compact: true })}`
        : visibleSamples[0]
            ? formatHistoryDate(visibleSamples[0].date, { compact: true })
            : "No history yet";

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label={`Advanced statistics for ${countryName}`} style={{ alignItems: "center", background: "rgba(2,6,15,0.8)", backdropFilter: "blur(10px)", display: "flex", inset: 0, justifyContent: "center", padding: "clamp(0.8rem, 2vw, 1.6rem)", position: "fixed", zIndex: 2147483000 }}>
            <div style={{ background: "linear-gradient(180deg, rgba(15,26,41,0.995), rgba(7,13,22,0.995))", border: "1px solid var(--oh-hud-border)", borderRadius: "18px", boxShadow: "var(--oh-hud-shadow)", display: "flex", flexDirection: "column", height: "min(880px, calc(100vh - 2.4rem))", maxWidth: "1380px", minHeight: "580px", overflow: "hidden", width: "min(96vw, 1380px)" }}>
                <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.75rem", padding: "0.85rem 1rem" }}>
                    <div style={{ alignItems: "center", backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "9px", display: "flex", flexShrink: 0, height: "2.25rem", justifyContent: "center", overflow: "hidden", width: "2.25rem" }}>
                        {flagUrl ? <img alt="" src={flagUrl} style={{ height: "100%", objectFit: "cover", width: "100%" }} /> : <span style={{ color: "#93c5fd", fontSize: "0.72rem", fontWeight: 900 }}>{flagFallback}</span>}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ alignItems: "baseline", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.65rem" }}>
                            <span style={{ color: "#f8fafc", fontSize: "1rem", fontWeight: 900 }}>Advanced Statistics</span>
                            <span style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.76rem", fontWeight: 700 }}>{countryName}</span>
                        </div>
                        <div data-no-translate style={{ color: "rgba(255,255,255,0.32)", fontSize: "0.64rem", marginTop: "0.15rem" }}>{sampleSpan} · {visibleSamples.length} snapshot{visibleSamples.length === 1 ? "" : "s"}</div>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close advanced statistics" style={{ alignItems: "center", background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "8px", color: "rgba(255,255,255,0.62)", cursor: "pointer", display: "flex", fontSize: "1rem", height: "2.25rem", justifyContent: "center", width: "2.25rem" }}>×</button>
                </div>

                <div style={{ display: "grid", flex: 1, gridTemplateColumns: "minmax(0, 1fr) minmax(285px, 330px)", minHeight: 0 }}>
                    <div style={{ display: "flex", flexDirection: "column", minHeight: 0, padding: "1rem 1rem 0.9rem" }}>
                        <div style={{ alignItems: "flex-start", display: "flex", flexWrap: "wrap", gap: "0.55rem", justifyContent: "space-between", marginBottom: "0.35rem" }}>
                            <div>
                                <div style={{ color: "rgba(255,255,255,0.9)", fontSize: "0.82rem", fontWeight: 850 }}>{selectedMetrics.map((metric) => metric.label).join(" · ")}</div>
                                <div style={{ color: "rgba(255,255,255,0.34)", fontSize: "0.64rem", marginTop: "0.15rem" }}>{ADVANCED_UNIT_LABELS[selectedUnit]}</div>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.55rem" }}>
                                {selectedMetrics.map((metric) => <span key={metric.key} style={{ alignItems: "center", color: "rgba(255,255,255,0.58)", display: "inline-flex", fontSize: "0.63rem", gap: "0.3rem" }}><span style={{ backgroundColor: metric.color, borderRadius: "999px", height: "7px", width: "7px" }} />{metric.label}</span>)}
                            </div>
                        </div>

                        <div style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.028), rgba(255,255,255,0.012))", border: "1px solid rgba(255,255,255,0.065)", borderRadius: "12px", display: "flex", flex: 1, minHeight: "390px", overflow: "hidden", padding: "0.35rem" }}>
                            {status === "loading" ? (
                                <div style={{ alignItems: "center", color: "rgba(255,255,255,0.42)", display: "flex", flex: 1, fontSize: "0.82rem", justifyContent: "center" }}>Loading campaign history…</div>
                            ) : status === "error" ? (
                                <div style={{ alignItems: "center", color: "#fca5a5", display: "flex", flex: 1, fontSize: "0.8rem", justifyContent: "center", padding: "2rem", textAlign: "center" }}>{error || "Historical Stats could not be loaded."}</div>
                            ) : (
                                <AdvancedLineChart samples={visibleSamples} metricKeys={metricKeys} />
                            )}
                        </div>

                        {first && last && (
                            <div style={{ display: "grid", gap: "0.55rem", gridTemplateColumns: `repeat(${Math.min(4, selectedMetrics.length)}, minmax(0, 1fr))`, marginTop: "0.7rem" }}>
                                {selectedMetrics.map((metric) => {
                                    const start = Number(first?.[metric.key]);
                                    const end = Number(last?.[metric.key]);
                                    const delta = Number.isFinite(start) && Number.isFinite(end) ? end - start : null;
                                    const deltaText = delta == null
                                        ? "—"
                                        : metric.unit === "gdp"
                                            ? formatEuroTotal(delta)
                                            : metric.unit === "gdpPerCapita"
                                                ? formatEuroPerCapita(delta)
                                                : metric.unit === "population"
                                                    ? formatCompactNumber(delta)
                                                    : `${delta > 0 ? "+" : ""}${Math.round(delta * 10) / 10}${metric.unit === "index" ? "" : " pp"}`;
                                    return (
                                        <div key={metric.key} style={{ backgroundColor: "rgba(255,255,255,0.028)", border: "1px solid rgba(255,255,255,0.065)", borderRadius: "9px", minWidth: 0, padding: "0.55rem 0.65rem" }}>
                                            <div style={{ color: "rgba(255,255,255,0.36)", fontSize: "0.55rem", fontWeight: 800, letterSpacing: "0.05em", overflow: "hidden", textOverflow: "ellipsis", textTransform: "uppercase", whiteSpace: "nowrap" }}>{metric.label}</div>
                                            <div data-no-translate style={{ color: metric.color, fontSize: "0.92rem", fontWeight: 900, marginTop: "0.16rem" }}>{metric.format(end)}</div>
                                            <div data-no-translate style={{ color: delta == null ? "rgba(255,255,255,0.3)" : delta > 0 ? "#86efac" : delta < 0 ? "#fca5a5" : "rgba(255,255,255,0.42)", fontSize: "0.58rem", marginTop: "0.08rem" }}>{deltaText} over range</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <aside style={{ backgroundColor: "rgba(3,8,18,0.24)", borderLeft: "1px solid rgba(255,255,255,0.07)", minHeight: 0, overflowY: "auto", padding: "0.9rem 0.85rem 1rem" }}>
                        <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.58rem", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>Time range</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem", marginTop: "0.5rem" }}>
                            {[['all', 'All'], ['1y', '1 year'], ['5y', '5 years'], ['10y', '10 years']].map(([key, label]) => <button key={key} type="button" onClick={() => setRange(key)} style={advancedRangeStyle(range === key)}>{label}</button>)}
                        </div>

                        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between", marginTop: "1rem" }}>
                            <span style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.58rem", fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>Statistics</span>
                            <span style={{ color: "rgba(147,197,253,0.8)", fontSize: "0.58rem", fontWeight: 800 }}>Selected {metricKeys.length}/4</span>
                        </div>
                        <div style={{ color: "rgba(255,255,255,0.28)", fontSize: "0.58rem", lineHeight: 1.4, marginTop: "0.3rem" }}>Compatible metrics can share a chart. Choosing a different scale switches the graph automatically.</div>

                        {ADVANCED_METRIC_GROUPS.map((group) => (
                            <div key={group.key} style={{ borderTop: "1px solid rgba(255,255,255,0.065)", marginTop: "0.75rem", paddingTop: "0.65rem" }}>
                                <div style={{ color: "rgba(255,255,255,0.62)", fontSize: "0.68rem", fontWeight: 850, marginBottom: "0.35rem" }}>{group.icon} {group.label}</div>
                                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                                    {group.metrics.map((metric) => {
                                        const checked = metricKeys.includes(metric.key);
                                        const compatible = !selectedMetrics.length || selectedUnit === metric.unit || checked;
                                        return (
                                            <button key={metric.key} type="button" onClick={() => toggleMetric(metric)} style={{ alignItems: "center", backgroundColor: checked ? `${metric.color}16` : "transparent", border: `1px solid ${checked ? `${metric.color}50` : "transparent"}`, borderRadius: "7px", color: checked ? "rgba(255,255,255,0.9)" : compatible ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)", cursor: "pointer", display: "flex", fontSize: "0.66rem", fontWeight: checked ? 800 : 650, gap: "0.45rem", padding: "0.38rem 0.45rem", textAlign: "left", width: "100%" }}>
                                                <span aria-hidden="true" style={{ alignItems: "center", backgroundColor: checked ? metric.color : "rgba(255,255,255,0.08)", border: `1px solid ${checked ? metric.color : "rgba(255,255,255,0.13)"}`, borderRadius: "4px", color: "#07111f", display: "inline-flex", flexShrink: 0, fontSize: "0.55rem", fontWeight: 1000, height: "14px", justifyContent: "center", width: "14px" }}>{checked ? "✓" : ""}</span>
                                                <span style={{ flex: 1, minWidth: 0 }}>{metric.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}

                        <div style={{ backgroundColor: "rgba(59,130,246,0.07)", border: "1px solid rgba(96,165,250,0.14)", borderRadius: "9px", marginTop: "0.85rem", padding: "0.6rem 0.65rem" }}>
                            <div style={{ color: "#bfdbfe", fontSize: "0.63rem", fontWeight: 850 }}>Campaign history</div>
                            <div style={{ color: "rgba(255,255,255,0.38)", fontSize: "0.58rem", lineHeight: 1.45, marginTop: "0.2rem" }}>
                                {persistentCount} permanent sample{persistentCount === 1 ? "" : "s"}{recoveredCount > 0 ? ` · ${recoveredCount} recovered from rollback snapshots` : ""}. New completed turns are recorded automatically.
                            </div>
                        </div>
                    </aside>
                </div>
            </div>
        </div>,
        document.body,
    );
};

const HistoricalTrackingModal = ({
    open,
    onClose,
    settings,
    onChange,
    world,
    playerCountry,
    currentCountry,
}) => {
    const [search, setSearch] = useState("");

    useEffect(() => {
        if (!open) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKeyDown);
        const priorOverflow = document?.body?.style?.overflow ?? "";
        if (document?.body) document.body.style.overflow = "hidden";
        return () => {
            window.removeEventListener("keydown", onKeyDown);
            if (document?.body) document.body.style.overflow = priorOverflow;
        };
    }, [open, onClose]);

    const candidates = useMemo(() => {
        const collected = new Map();
        const add = (value) => {
            const key = canonicalPolityKey(value, world);
            if (!key || collected.has(lowerText(key))) return;
            if (world && isPolityLandless(world, key)) return;
            collected.set(lowerText(key), key);
        };
        add(playerCountry);
        add(currentCountry);
        Object.keys(world?.countryStats || {}).forEach(add);
        Object.keys(world?.polityOverrides || {}).forEach(add);
        return [...collected.values()].sort((a, b) => polityDisplayName(world, a).localeCompare(polityDisplayName(world, b)));
    }, [world, playerCountry, currentCountry]);

    const trackedPolities = settings?.trackedPolities || [];
    const filteredCandidates = useMemo(() => {
        const query = lowerText(search);
        if (!query) return candidates;
        return candidates.filter((key) => {
            const label = polityDisplayName(world, key);
            return lowerText(key).includes(query) || lowerText(label).includes(query);
        });
    }, [candidates, search, world]);

    const toggleCountry = useCallback((key) => {
        const canonical = canonicalPolityKey(key, world) || key;
        const current = normalizeCountryStatsTracking(settings, { playerCountry });
        const alreadyTracked = current.trackedPolities.some((item) => lowerText(item) === lowerText(canonical));
        let nextTracked = current.trackedPolities;
        if (alreadyTracked) {
            nextTracked = current.trackedPolities.filter((item) => lowerText(item) != lowerText(canonical));
        } else {
            nextTracked = [...current.trackedPolities, canonical];
        }
        onChange({ ...current, trackedPolities: nextTracked });
    }, [settings, onChange, playerCountry, world]);

    const setIntervalMonths = useCallback((intervalMonths) => {
        onChange({ ...(settings || {}), intervalMonths });
    }, [settings, onChange]);

    if (!open || typeof document === "undefined") return null;

    return createPortal(
        <div role="dialog" aria-modal="true" aria-label="Historical statistics tracking settings" style={{ alignItems: "center", background: "rgba(2,6,15,0.8)", backdropFilter: "blur(10px)", display: "flex", inset: 0, justifyContent: "center", padding: "clamp(0.8rem, 2vw, 1.6rem)", position: "fixed", zIndex: 2147483000 }}>
            <div style={{ background: "linear-gradient(180deg, rgba(15,26,41,0.995), rgba(7,13,22,0.995))", border: "1px solid var(--oh-hud-border)", borderRadius: "18px", boxShadow: "var(--oh-hud-shadow)", display: "flex", flexDirection: "column", height: "min(760px, calc(100vh - 2.4rem))", maxWidth: "980px", minHeight: "520px", overflow: "hidden", width: "min(94vw, 980px)" }}>
                <div style={{ alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.08)", display: "flex", gap: "0.8rem", justifyContent: "space-between", padding: "1rem 1.05rem 0.95rem" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "0.8rem", minWidth: 0 }}>
                        <div style={{ alignItems: "center", backgroundColor: "rgba(234,179,8,0.12)", border: "1px solid rgba(250,204,21,0.22)", borderRadius: "12px", color: "#fbbf24", display: "inline-flex", flexShrink: 0, fontSize: "1.2rem", height: "2.5rem", justifyContent: "center", width: "2.5rem" }}>⚙</div>
                        <div style={{ minWidth: 0 }}>
                            <div style={{ color: "#f8fafc", fontSize: "1.15rem", fontWeight: 850 }}>Historical tracking</div>
                            <div style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.75rem", marginTop: "0.12rem" }}>
                                Choose how often Stats should re-check tracked countries, and which countries you want on your long-term graphs.
                            </div>
                        </div>
                    </div>
                    <button type="button" onClick={onClose} style={{ alignItems: "center", backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "rgba(255,255,255,0.75)", cursor: "pointer", display: "inline-flex", flexShrink: 0, fontSize: "1rem", height: "2.4rem", justifyContent: "center", width: "2.4rem" }}>×</button>
                </div>

                <div style={{ display: "grid", flex: 1, gap: "1rem", gridTemplateColumns: "minmax(0, 1fr) minmax(280px, 330px)", minHeight: 0, padding: "1rem 1.05rem 1.05rem" }}>
                    <div style={{ minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column", gap: "0.9rem" }}>
                        <div style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "0.85rem 0.9rem" }}>
                            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.78rem", fontWeight: 800, marginBottom: "0.5rem" }}>Auto-refresh cadence</div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.45rem" }}>
                                {COUNTRY_STATS_TRACKING_INTERVALS.map((months) => {
                                    const active = Number(settings?.intervalMonths) === months;
                                    return (
                                        <button
                                            key={months}
                                            type="button"
                                            onClick={() => setIntervalMonths(months)}
                                            style={{
                                                backgroundColor: active ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                                                border: `1px solid ${active ? "rgba(96,165,250,0.5)" : "rgba(255,255,255,0.08)"}`,
                                                borderRadius: "999px",
                                                color: active ? "#dbeafe" : "rgba(255,255,255,0.68)",
                                                cursor: "pointer",
                                                fontSize: "0.72rem",
                                                fontWeight: active ? 800 : 700,
                                                padding: "0.44rem 0.7rem",
                                            }}
                                        >
                                            {months === 0 ? "Off" : `${months} months`}
                                        </button>
                                    );
                                })}
                            </div>
                            <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.68rem", lineHeight: 1.45, marginTop: "0.55rem" }}>
                                Current setting: <span style={{ color: "#dbeafe" }}>{countryStatsTrackingIntervalLabel(settings?.intervalMonths)}</span>.
                                {" "}Your country is automatically kept in the tracked list whenever auto-refresh is enabled.
                            </div>
                        </div>

                        <div style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "0.85rem 0.9rem", display: "flex", flexDirection: "column", minHeight: 0, flex: 1 }}>
                            <div style={{ alignItems: "center", display: "flex", gap: "0.7rem", justifyContent: "space-between" }}>
                                <div>
                                    <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.78rem", fontWeight: 800 }}>Tracked countries</div>
                                    <div style={{ color: "rgba(255,255,255,0.42)", fontSize: "0.66rem", marginTop: "0.1rem" }}>
                                        Pick up to {COUNTRY_STATS_TRACKING_MAX_POLITIES} countries to keep historical charts rich without overloading the simulation.
                                    </div>
                                </div>
                                <div style={{ backgroundColor: "rgba(59,130,246,0.09)", border: "1px solid rgba(96,165,250,0.18)", borderRadius: "999px", color: "#bfdbfe", fontSize: "0.68rem", fontWeight: 800, padding: "0.25rem 0.55rem" }}>
                                    {trackedPolities.length}/{COUNTRY_STATS_TRACKING_MAX_POLITIES}
                                </div>
                            </div>

                            <input
                                type="text"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                placeholder="Search countries..."
                                style={{ backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.09)", borderRadius: "10px", color: "#fff", fontSize: "0.78rem", marginTop: "0.75rem", outline: "none", padding: "0.6rem 0.72rem" }}
                            />

                            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", marginTop: "0.7rem" }}>
                                {trackedPolities.map((key) => {
                                    const label = polityDisplayName(world, key);
                                    const isPlayer = lowerText(key) === lowerText(playerCountry);
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => toggleCountry(key)}
                                            style={{ alignItems: "center", backgroundColor: "rgba(59,130,246,0.12)", border: "1px solid rgba(96,165,250,0.2)", borderRadius: "999px", color: "#dbeafe", cursor: "pointer", display: "inline-flex", fontSize: "0.68rem", gap: "0.45rem", padding: "0.35rem 0.6rem" }}
                                            title="Remove from tracked countries"
                                        >
                                            <span>{label}</span>
                                            {isPlayer && <span style={{ color: "#fbbf24", fontSize: "0.62rem", fontWeight: 800 }}>you</span>}
                                            <span style={{ color: "rgba(255,255,255,0.45)" }}>×</span>
                                        </button>
                                    );
                                })}
                                {!trackedPolities.length && (
                                    <div style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.68rem" }}>No countries tracked yet.</div>
                                )}
                            </div>

                            <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", display: "flex", flexDirection: "column", gap: "0.35rem", marginTop: "0.85rem", minHeight: 0, overflowY: "auto", paddingTop: "0.85rem" }}>
                                {filteredCandidates.map((key) => {
                                    const tracked = trackedPolities.some((item) => lowerText(item) === lowerText(key));
                                    const isPlayer = lowerText(key) === lowerText(playerCountry);
                                    const isViewed = lowerText(key) === lowerText(currentCountry);
                                    const maxed = !tracked && trackedPolities.length >= COUNTRY_STATS_TRACKING_MAX_POLITIES;
                                    return (
                                        <button
                                            key={key}
                                            type="button"
                                            onClick={() => toggleCountry(key)}
                                            disabled={maxed}
                                            style={{
                                                alignItems: "center",
                                                backgroundColor: tracked ? "rgba(34,197,94,0.08)" : "rgba(255,255,255,0.02)",
                                                border: `1px solid ${tracked ? "rgba(34,197,94,0.24)" : "rgba(255,255,255,0.07)"}`,
                                                borderRadius: "10px",
                                                color: tracked ? "rgba(255,255,255,0.92)" : maxed ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.7)",
                                                cursor: maxed ? "not-allowed" : "pointer",
                                                display: "flex",
                                                justifyContent: "space-between",
                                                opacity: maxed ? 0.75 : 1,
                                                padding: "0.6rem 0.72rem",
                                                textAlign: "left",
                                                width: "100%",
                                            }}
                                        >
                                            <span style={{ minWidth: 0 }}>
                                                <span style={{ alignItems: "center", display: "flex", gap: "0.4rem", minWidth: 0 }}>
                                                    <span aria-hidden="true" style={{ alignItems: "center", backgroundColor: tracked ? "#22c55e" : "rgba(255,255,255,0.06)", border: `1px solid ${tracked ? "#22c55e" : "rgba(255,255,255,0.12)"}`, borderRadius: "4px", color: "#07111f", display: "inline-flex", flexShrink: 0, fontSize: "0.55rem", fontWeight: 1000, height: "14px", justifyContent: "center", width: "14px" }}>{tracked ? "✓" : ""}</span>
                                                    <span style={{ fontSize: "0.74rem", fontWeight: tracked ? 800 : 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{polityDisplayName(world, key)}</span>
                                                </span>
                                                <span style={{ alignItems: "center", color: "rgba(255,255,255,0.42)", display: "flex", flexWrap: "wrap", fontSize: "0.62rem", gap: "0.35rem", marginTop: "0.18rem" }}>
                                                    {isPlayer && <span style={{ color: "#fbbf24" }}>your country</span>}
                                                    {isViewed && !isPlayer && <span style={{ color: "#93c5fd" }}>currently viewed</span>}
                                                    {!isPlayer && !isViewed && <span>{cleanText(key)}</span>}
                                                    <span style={{ color: world?.countryStats?.[key] ? "#86efac" : "#fbbf24" }}>
                                                        {world?.countryStats?.[key] ? "Stats ready" : "baseline needed"}
                                                    </span>
                                                </span>
                                            </span>
                                            <span style={{ color: tracked ? "#86efac" : "rgba(255,255,255,0.38)", flexShrink: 0, fontSize: "0.68rem", fontWeight: 800 }}>
                                                {tracked ? "Tracked" : maxed ? "Full" : "Add"}
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <aside style={{ display: "flex", flexDirection: "column", gap: "0.9rem", minHeight: 0 }}>
                        <div style={{ backgroundColor: "rgba(59,130,246,0.07)", border: "1px solid rgba(96,165,250,0.14)", borderRadius: "12px", padding: "0.85rem 0.9rem" }}>
                            <div style={{ color: "#bfdbfe", fontSize: "0.78rem", fontWeight: 850 }}>At a glance</div>
                            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.68rem", lineHeight: 1.5, marginTop: "0.3rem" }}>
                                Auto-refresh is currently set to <span style={{ color: "#dbeafe" }}>{countryStatsTrackingIntervalLabel(settings?.intervalMonths)}</span>.
                                {" "}When tracked countries become due, Continuum refreshes all initialized sheets in one bounded AI batch after a completed turn. Countries marked <span style={{ color: "#fbbf24" }}>baseline needed</span> begin auto-refreshing after their first normal Stats sheet exists.
                            </div>
                        </div>
                        <div style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "12px", padding: "0.85rem 0.9rem" }}>
                            <div style={{ color: "rgba(255,255,255,0.8)", fontSize: "0.74rem", fontWeight: 800 }}>Suggested approach</div>
                            <ul style={{ color: "rgba(255,255,255,0.48)", fontSize: "0.67rem", lineHeight: 1.5, margin: "0.5rem 0 0", paddingLeft: "1rem" }}>
                                <li>Keep your country tracked.</li>
                                <li>Add nearby powers or direct rivals.</li>
                                <li>6 months is a good default.</li>
                                <li>Stay bounded: 4–8 countries is usually plenty.</li>
                            </ul>
                        </div>
                        <div style={{ marginTop: "auto", display: "flex", gap: "0.6rem" }}>
                            <button type="button" onClick={onClose} style={{ backgroundColor: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "10px", color: "rgba(255,255,255,0.75)", cursor: "pointer", flex: 1, fontSize: "0.76rem", fontWeight: 800, padding: "0.7rem 0.85rem" }}>Done</button>
                        </div>
                    </aside>
                </div>
            </div>
        </div>,
        document.body,
    );
};

const StatsPaneBody = ({ active }) => {
    const { activeGameId } = useLibraryState();
    const [player, setPlayer] = useState({ code: "", date: "", startDate: "", round: 0, gameKey: "game" });
    const [targetCountry, setTargetCountry] = useState("");
    const [polity, setPolity] = useState(null); // world.polityOverrides[target]
    const [worldSnapshot, setWorldSnapshot] = useState(null);
    const worldSnapshotRef = useRef(null);
    const statsLoadRef = useRef({ sequence: 0, controller: null });
    const [statsView, setStatsView] = useState("diplomacy");
    const [advancedOpen, setAdvancedOpen] = useState(false);
    const [trackingOpen, setTrackingOpen] = useState(false);
    const [trackingSettings, setTrackingSettings] = useState({ intervalMonths: 0, trackedPolities: [] });
    const [historyState, setHistoryState] = useState({ status: "idle", samples: [], error: "", recoveredCount: 0, persistentCount: 0 });
    const [state, setState] = useState({ status: "idle", sheet: null, error: "" });
    const [flagFailed, setFlagFailed] = useState(false);
    // Is the PLAYER stateless (holds no territory)? A landless player's code may
    // still resolve to a real country, but they are not it — so their own row
    // must show the neutral initials, never that country's flag.
    const [playerLandless, setPlayerLandless] = useState(false);
    // Author-set flags from the scenario (flags.json). Memoized in assets.js, so
    // this is one fetch per scenario; {} for every scenario that sets none.
    const [customFlags, setCustomFlags] = useState({});

    useEffect(() => {
        worldSnapshotRef.current = worldSnapshot;
    }, [worldSnapshot]);
    const displayName = useCountryDisplayName(targetCountry);

    const persistTrackingSettings = useCallback((next) => {
        const normalized = normalizeCountryStatsTracking(next, { playerCountry: player.code });
        setTrackingSettings(normalized);
        storeTrackingSettingsFallback(player.gameKey, normalized, player.code);

        // Canonical copy travels with the save. Preserve scheduler-owned metadata
        // such as lastAutoRefreshByPolity when the UI changes cadence/membership.
        readWorldState({ force: false })
            .then((world) => {
                const prior = normalizeCountryStatsTracking(world?.countryStatsTracking, { playerCountry: player.code });
                const canonical = normalizeCountryStatsTracking({
                    ...prior,
                    intervalMonths: normalized.intervalMonths,
                    trackedPolities: normalized.trackedPolities,
                }, { playerCountry: player.code });
                return writeWorldState({
                    ...(world || {}),
                    countryStatsTracking: canonical,
                });
            })
            .catch((error) => {
                console.warn("[stats auto] tracking settings could not be persisted to world state; local fallback retained.", error);
            });
    }, [player.code, player.gameKey]);

    useEffect(() => {
        if (!active) return undefined;
        let cancelled = false;

        readWorldStateView({ force: false })
            .then(async (world) => {
                if (cancelled) return;
                const hasCanonical = Boolean(
                    world?.countryStatsTracking &&
                    typeof world.countryStatsTracking === "object" &&
                    !Array.isArray(world.countryStatsTracking)
                );
                const next = hasCanonical
                    ? normalizeCountryStatsTracking(world.countryStatsTracking, { playerCountry: player.code })
                    : readTrackingSettingsFallback(player.gameKey, player.code);
                setTrackingSettings(next);

                // One-time migration for R2.25 local-only preferences.
                if (!hasCanonical && (next.intervalMonths > 0 || next.trackedPolities.length > 0)) {
                    try {
                        await writeWorldState({
                            ...(world || {}),
                            countryStatsTracking: next,
                        });
                    } catch {
                        // Local fallback remains usable if this best-effort migration fails.
                    }
                }
            })
            .catch(() => {
                if (!cancelled) setTrackingSettings(readTrackingSettingsFallback(player.gameKey, player.code));
            });

        return () => { cancelled = true; };
    }, [active, player.gameKey, player.code]);

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

        const applyGame = (game) => {
            if (cancelled || !game) return;
            const code = String(game?.country || "").trim();
            const nextPlayer = {
                code,
                date: String(game?.gameDate || game?.startDate || ""),
                startDate: String(game?.startDate || game?.gameDate || ""),
                round: Math.max(0, Math.trunc(Number(game?.round) || 0)),
                gameKey: String(activeGameId || game?.id || game?.name || JSON_URLS.game || "game"),
            };
            setPlayer((current) => {
                if (current.gameKey !== nextPlayer.gameKey) {
                    setTargetCountry(code);
                    setState({ status: "idle", sheet: null, error: "" });
                    setWorldSnapshot(null);
                } else {
                    setTargetCountry((target) => target || code);
                }
                return current.code === nextPlayer.code &&
                    current.date === nextPlayer.date &&
                    current.startDate === nextPlayer.startDate &&
                    current.round === nextPlayer.round &&
                    current.gameKey === nextPlayer.gameKey
                        ? current
                        : nextPlayer;
            });
        };

        readGameData({ force: false }).then(applyGame).catch(() => {});

        const onGameUpdated = (event) => applyGame(event?.detail?.game);
        const onVisibility = () => {
            if (document.visibilityState !== "visible") return;
            const run = () => readGameData({ force: true }).then(applyGame).catch(() => {});
            if (typeof window.requestIdleCallback === "function") {
                window.requestIdleCallback(run, { timeout: 2500 });
            } else {
                window.setTimeout(run, 250);
            }
        };
        window.addEventListener("oh:game-updated", onGameUpdated);
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            cancelled = true;
            window.removeEventListener("oh:game-updated", onGameUpdated);
            document.removeEventListener("visibilitychange", onVisibility);
        };
    }, [active, activeGameId]);

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
            // R2.31: country switching must not normalize/read world again when Stats
            // already has the live canonical snapshot in memory.
            try {
                const world = worldSnapshotRef.current || await readWorldStateView({ force: false });
                const persisted = world?.countryStats?.[code];
                const persistedIsValid = persisted && isValidStatSheet(persisted);
                const persistedNeedsCapAudit = persistedIsValid && needsLegacyComponentCapAudit(persisted);
                const persistedNeedsPopulationAudit = persistedIsValid && needsStartPopulationCalibrationAudit(persisted, player);
                const persistedNeedsNativeAudit = persistedNeedsCapAudit || persistedNeedsPopulationAudit;
                if (persistedIsValid && !persistedNeedsNativeAudit) {
                    memoryCache.set(cacheKey, { date: player.date, sheet: persisted });
                    setState({ status: "ready", sheet: persisted, error: "" });
                    return;
                }
                // Incomplete on its own, but still the AI's word on the fields it names.
                // A valid sheet that needs native migration/audit is deliberately NOT
                // layered into cache fallback; generateCountryStatSheet owns that repair.
                if (persisted && typeof persisted === "object" && !persistedNeedsNativeAudit) aiOverride = persisted;
                if (persistedNeedsNativeAudit) aiOverride = null;
            } catch { /* fall through to the device cache / regenerate */ }
            // Device-cache fallback — no longer date-gated, so it persists across dates.
            const cached = memoryCache.get(cacheKey) ?? readStoredSheets()[cacheKey];
            if (
                cached &&
                isValidStatSheet(cached.sheet) &&
                !needsLegacyComponentCapAudit(cached.sheet) &&
                !needsStartPopulationCalibrationAudit(cached.sheet, player)
            ) {
                const sheet = mergeStatSheet(cached.sheet, aiOverride);
                memoryCache.set(cacheKey, { date: player.date, sheet });
                setState({ status: "ready", sheet, error: "" });
                return;
            }
        }
        statsLoadRef.current.controller?.abort?.(
            new DOMException("Superseded by another country selection.", "AbortError")
        );
        const controller = new AbortController();
        const sequence = statsLoadRef.current.sequence + 1;
        statsLoadRef.current = { sequence, controller };

        setState({ status: "loading", sheet: null, error: "" });

        // A country may legitimately take seconds to calculate/generate. Paint the
        // loading card and return control to the map before starting that work.
        await new Promise((resolve) => {
            if (typeof window.requestAnimationFrame === "function") {
                window.requestAnimationFrame(() => window.setTimeout(resolve, 0));
            } else {
                window.setTimeout(resolve, 0);
            }
        });

        try {
            // targetCountry is the stable campaign identity key. A polity rename keeps
            // that key on purpose, so resolve the CURRENT display name separately for
            // the human-facing header and the Stats generation prompt. Identity and
            // territorial scope remain independent: a renamed polity does not gain land.
            let generationName = displayName || code;
            try {
                const latestWorld = worldSnapshotRef.current || await readWorldStateView({ force: false });
                const liveName = String(latestWorld?.polityOverrides?.[code]?.name || "").trim();
                if (liveName) generationName = liveName;
            } catch { /* display-name lookup is non-fatal */ }

            const generated = await generateCountryStatSheet({ code, name: generationName, forceReassess, signal: controller.signal });
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
            if (statsLoadRef.current.sequence !== sequence || controller.signal.aborted) return;
            startTransition(() => {
                setState((current) =>
                    targetCountry === code ? { status: "ready", sheet, error: "" } : current);
            });
        } catch (error) {
            if (controller.signal.aborted || error?.name === "AbortError") return;
            if (statsLoadRef.current.sequence !== sequence) return;
            setState((current) =>
                targetCountry === code
                    ? { status: "error", sheet: null, error: error?.message || "The stat sheet failed." }
                    : current);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [targetCountry, player.gameKey, player.date, player.startDate, player.round, displayName]);

    useEffect(() => () => {
        statsLoadRef.current.controller?.abort?.(
            new DOMException("Stats panel/selection changed.", "AbortError")
        );
    }, [targetCountry]);

    // Cheats 2.0 country edits mutate the same canonical world.countryStats seam.
    // If this pane is already open, consume the lightweight local event and refresh
    // from world state immediately instead of showing a stale pre-edit browser view.
    useEffect(() => {
        if (!active || !targetCountry || typeof window === "undefined") return undefined;

        let cancelled = false;
        const onCountryStatsUpdated = async (event) => {
            const changedCountry = String(event?.detail?.country || "").trim();
            if (changedCountry && changedCountry !== targetCountry) return;

            // Native Stats generation supplies the exact persisted sheet directly.
            // Consume it without rereading/normalizing the whole world and without
            // replacing worldSnapshot (which would make the entire Stats tree
            // reconsider unrelated polity/map state).
            const directSheet = event?.detail?.sheet;
            if (directSheet && typeof directSheet === "object") {
                const cacheKey = `${player.gameKey}:${targetCountry}`;
                const entry = { date: player.date, sheet: directSheet };
                memoryCache.set(cacheKey, entry);
                storeSheet(cacheKey, entry);

                // Keep the read-only ref coherent for subsequent country revisits,
                // but do not trigger a React worldSnapshot update for a Stats-only
                // domain change.
                const currentWorld = worldSnapshotRef.current;
                if (currentWorld && typeof currentWorld === "object") {
                    worldSnapshotRef.current = {
                        ...currentWorld,
                        countryStats: {
                            ...(currentWorld.countryStats || {}),
                            [targetCountry]: directSheet,
                        },
                    };
                }

                if (!cancelled) {
                    startTransition(() => {
                        setState({ status: "ready", sheet: directSheet, error: "" });
                    });
                }
                return;
            }

            // Legacy/Cheats event shape: no sheet in the event, so use the canonical
            // read-only view as a compatibility fallback.
            try {
                const world = await readWorldStateView({ force: false });
                if (cancelled) return;

                const persisted = world?.countryStats?.[targetCountry];
                if (persisted && typeof persisted === "object") {
                    const cacheKey = `${player.gameKey}:${targetCountry}`;
                    const entry = { date: player.date, sheet: persisted };
                    memoryCache.set(cacheKey, entry);
                    storeSheet(cacheKey, entry);
                    setState({ status: "ready", sheet: persisted, error: "" });
                }

                worldSnapshotRef.current = world || {};
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

        if (worldSnapshot) {
            setPolity(worldSnapshot?.polityOverrides?.[targetCountry] ?? null);
            setPlayerLandless(isPolityLandless(worldSnapshot, player.code));
            return;
        }

        // Cold-open fallback only. Once loaded, oh:world-updated keeps the snapshot
        // current and country inspection becomes a pure in-memory UI operation.
        readWorldStateView({ force: false })
            .then((world) => {
                worldSnapshotRef.current = world || {};
                setWorldSnapshot(world || {});
                setPolity(world?.polityOverrides?.[targetCountry] ?? null);
                setPlayerLandless(isPolityLandless(world, player.code));
            })
            .catch(() => {
                setWorldSnapshot(null);
                setPolity(null);
                setPlayerLandless(false);
            });
    }, [active, targetCountry, player.code, worldSnapshot]);

    useEffect(() => {
        if (!active || !targetCountry || statsView !== "economy") return;
        void loadSheet();
    }, [active, targetCountry, statsView, loadSheet]);

    useEffect(() => {
        if (!active || typeof window === "undefined") return undefined;
        const onWorldUpdated = (event) => {
            const world = event?.detail?.world;
            if (!world) return;
            worldSnapshotRef.current = world;
            setWorldSnapshot(world);
            setPolity(world?.polityOverrides?.[targetCountry] ?? null);
            setPlayerLandless(isPolityLandless(world, player.code));
        };
        window.addEventListener("oh:world-updated", onWorldUpdated);
        return () => window.removeEventListener("oh:world-updated", onWorldUpdated);
    }, [active, targetCountry, player.code]);

    // Advanced Statistics loads lazily. Existing permanent history wins, the
    // rolling rollback window is harvested as a migration/backfill source, and the
    // current sheet is appended as the newest point. Backfill is persisted so old
    // snapshots may expire without erasing the graph we already recovered from them.
    useEffect(() => {
        if (!active || !advancedOpen || !targetCountry) return undefined;
        let cancelled = false;

        const loadHistory = async () => {
            setHistoryState((current) => ({ ...current, status: "loading", error: "" }));
            try {
                const [world, snapshots] = await Promise.all([
                    readWorldStateView({ force: false }),
                    readJson(JSON_URLS.snapshots, {
                        defaultValue: [],
                        force: true,
                        clone: false,
                    }).catch(() => []),
                ]);
                if (cancelled) return;

                const persistent = normalizeCountryStatsHistory(world?.countryStatsHistory);
                const persistentCount = (persistent[targetCountry] || []).length;
                let recoveredHistory = {};

                for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
                    const snapshotWorld = snapshot?.state?.world || {};
                    const snapshotKey = canonicalPolityKey(targetCountry, snapshotWorld) || targetCountry;
                    const snapshotSheet = snapshotWorld?.countryStats?.[snapshotKey] || snapshotWorld?.countryStats?.[targetCountry];
                    const sample = buildCountryStatHistorySample(snapshotSheet, {
                        date: snapshot?.state?.game?.gameDate || snapshot?.fromDate || "",
                        round: snapshot?.state?.game?.round ?? snapshot?.round ?? 0,
                    });
                    if (sample) {
                        recoveredHistory = appendCountryStatHistorySample(recoveredHistory, targetCountry, sample);
                    }
                }

                let merged = mergeCountryStatsHistory(persistent, recoveredHistory);
                const currentKey = canonicalPolityKey(targetCountry, world) || targetCountry;
                const currentSheet = world?.countryStats?.[currentKey] || world?.countryStats?.[targetCountry] || state.sheet;
                merged = appendCountryStatHistorySample(merged, targetCountry, currentSheet, {
                    date: player.date,
                    round: player.round,
                });

                const samples = merged[targetCountry] || [];
                const recoveredCount = Math.max(0, samples.length - persistentCount);
                setHistoryState({ status: "ready", samples, error: "", recoveredCount, persistentCount });

                const persistedSeries = persistent[targetCountry] || [];
                if (JSON.stringify(persistedSeries) !== JSON.stringify(samples)) {
                    try {
                        // Re-read immediately before the best-effort migration write so
                        // opening a chart cannot put a stale pre-turn world object back
                        // over newer canonical state. Only the compact history field is
                        // merged onto this freshest copy.
                        const latestWorld = await readWorldStateView({ force: false });
                        let latestHistory = mergeCountryStatsHistory(
                            latestWorld?.countryStatsHistory,
                            recoveredHistory,
                        );
                        const latestKey = canonicalPolityKey(targetCountry, latestWorld) || targetCountry;
                        latestHistory = appendCountryStatHistorySample(
                            latestHistory,
                            targetCountry,
                            latestWorld?.countryStats?.[latestKey] || latestWorld?.countryStats?.[targetCountry] || currentSheet,
                            { date: player.date, round: player.round },
                        );
                        await writeWorldState({
                            ...latestWorld,
                            countryStatsHistory: latestHistory,
                        });
                    } catch (error) {
                        console.warn("[stats 8B.3] rollback history backfill could not be persisted; chart remains available this session.", error);
                    }
                }
            } catch (error) {
                if (!cancelled) {
                    setHistoryState({ status: "error", samples: [], error: error?.message || "Historical Stats could not be loaded.", recoveredCount: 0, persistentCount: 0 });
                }
            }
        };

        loadHistory();
        return () => { cancelled = true; };
    }, [active, advancedOpen, targetCountry, player.date, player.round, state.sheet]);

    const sheet = state.sheet;
    // Header identity can safely use the already-loaded canonical world's shallow
    // stat metadata while Economy itself waits for the validated/migrated sheet.
    // This preserves capital/government/leader text without triggering heavy Stats
    // generation on the default Diplomacy tab.
    const headerSheet = sheet || worldSnapshot?.countryStats?.[targetCountry] || null;
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

    const trackingNames = trackingSettings.trackedPolities
        .map((key) => polityDisplayName(worldSnapshot, key))
        .filter(Boolean);
    const trackingPreview = !trackingNames.length
        ? "No tracked countries yet"
        : trackingNames.length <= 3
            ? trackingNames.join(", ")
            : `${trackingNames.slice(0, 3).join(", ")} +${trackingNames.length - 3} more`;

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
            <div style={{ alignItems: "center", display: "flex", flexWrap: "wrap", gap: "0.35rem 0.5rem" }}>
            <span style={{ flex: "1 1 9rem", fontSize: "1.02rem", fontWeight: 800, lineHeight: 1.15, minWidth: 0, overflowWrap: "anywhere" }}>
            {polity?.name || displayName || targetCountry}
            </span>
            {isPlayer && (
                <span style={{ backgroundColor: "rgba(245,158,11,0.18)", border: "1px solid rgba(245,158,11,0.5)", borderRadius: "999px", color: "#fbbf24", flexShrink: 0, fontSize: "0.62rem", fontWeight: 700, padding: "0.14rem 0.5rem" }}>
                Your country
                </span>
            )}
            </div>
            {headerSheet && (
                <>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "0.76rem", marginTop: "0.15rem" }}>
                {[headerSheet.capital, headerSheet.continent].filter(Boolean).join(" · ")}
                </div>
                {headerSheet.government && (
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "0.72rem", marginTop: "0.1rem" }}>
                    {headerSheet.government}
                    </div>
                )}
                {headerSheet.leader && (
                    <div style={{ color: "#fbbf24", fontSize: "0.72rem", marginTop: "0.1rem" }}>
                    Leader: {headerSheet.leader}
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

                <button
                type="button"
                onClick={() => setAdvancedOpen(true)}
                style={{ alignItems: "center", background: "linear-gradient(135deg, rgba(37,99,235,0.18), rgba(14,165,233,0.08))", border: "1px solid rgba(96,165,250,0.34)", borderRadius: "11px", color: "#dbeafe", cursor: "pointer", display: "flex", gap: "0.65rem", justifyContent: "space-between", marginTop: "0.9rem", padding: "0.72rem 0.8rem", textAlign: "left", width: "100%" }}
                >
                    <span style={{ alignItems: "center", display: "flex", gap: "0.6rem", minWidth: 0 }}>
                        <span style={{ alignItems: "center", backgroundColor: "rgba(59,130,246,0.18)", border: "1px solid rgba(147,197,253,0.2)", borderRadius: "8px", display: "inline-flex", flexShrink: 0, fontSize: "1rem", height: "2rem", justifyContent: "center", width: "2rem" }}>📊</span>
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: "0.76rem", fontWeight: 850 }}>Advanced statistics</span>
                            <span style={{ color: "rgba(255,255,255,0.42)", display: "block", fontSize: "0.62rem", marginTop: "0.08rem" }}>Explore campaign trends and historical snapshots</span>
                        </span>
                    </span>
                    <span style={{ color: "rgba(147,197,253,0.75)", flexShrink: 0, fontSize: "1rem" }}>›</span>
                </button>

                <button
                type="button"
                onClick={() => setTrackingOpen(true)}
                style={{ alignItems: "center", background: "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.035))", border: "1px solid rgba(255,255,255,0.08)", borderRadius: "11px", color: "#e5e7eb", cursor: "pointer", display: "flex", gap: "0.7rem", justifyContent: "space-between", marginTop: "0.55rem", padding: "0.72rem 0.8rem", textAlign: "left", width: "100%" }}
                >
                    <span style={{ alignItems: "center", display: "flex", gap: "0.65rem", minWidth: 0 }}>
                        <span style={{ alignItems: "center", backgroundColor: "rgba(234,179,8,0.12)", border: "1px solid rgba(250,204,21,0.22)", borderRadius: "8px", color: "#fbbf24", display: "inline-flex", flexShrink: 0, fontSize: "0.98rem", height: "2rem", justifyContent: "center", width: "2rem" }}>⚙</span>
                        <span style={{ minWidth: 0 }}>
                            <span style={{ display: "block", fontSize: "0.75rem", fontWeight: 850 }}>Historical tracking</span>
                            <span style={{ color: "rgba(255,255,255,0.46)", display: "block", fontSize: "0.62rem", marginTop: "0.08rem" }}>
                                Auto-refresh: {countryStatsTrackingIntervalLabel(trackingSettings.intervalMonths)} · Tracked: {trackingSettings.trackedPolities.length}/{COUNTRY_STATS_TRACKING_MAX_POLITIES}
                            </span>
                            <span style={{ color: "rgba(255,255,255,0.34)", display: "block", fontSize: "0.6rem", marginTop: "0.14rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {trackingPreview}
                            </span>
                        </span>
                    </span>
                    <span style={{ color: "rgba(255,255,255,0.5)", flexShrink: 0, fontSize: "0.95rem" }}>›</span>
                </button>
                </>
            )}

            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem", marginTop: "1rem" }}>
            Click any country on the map to inspect it.
            </p>
            </>
        )}
        </div>
        {advancedOpen && (
            <AdvancedStatsModal
            open
            onClose={() => setAdvancedOpen(false)}
            countryName={polity?.name || displayName || targetCountry}
            flagUrl={flagUrl && !flagFailed ? flagUrl : ""}
            flagFallback={initials}
            samples={historyState.samples}
            status={historyState.status}
            error={historyState.error}
            recoveredCount={historyState.recoveredCount}
            persistentCount={historyState.persistentCount}
            />
        )}
        {trackingOpen && (
            <HistoricalTrackingModal
            open
            onClose={() => setTrackingOpen(false)}
            settings={trackingSettings}
            onChange={persistTrackingSettings}
            world={worldSnapshot}
            playerCountry={player.code}
            currentCountry={targetCountry}
            />
        )}
        </div>
    );
};

const reportStatsRender = (id, phase, actualDuration) => {
    reportPerfOperation(`React ${id} ${phase}`, Number(actualDuration) || 0, { warnAt: 30 });
};

const StatsPane = memo(function StatsPane({ active }) {
    if (!active) return null;
    return (
        <React.Profiler id="StatsPane" onRender={reportStatsRender}>
            <StatsPaneBody active />
        </React.Profiler>
    );
});

export default StatsPane;
